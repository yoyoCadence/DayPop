import type { DayPopUserData, SharingScope } from '../domain/types';
import { parseDomainId } from '../domain/validation';
import type { DayPopRepository } from './repository';

/** Session metadata only. Never add this to DayPopUserData or its v4 envelope. */
export interface CalendarShare {
  calendarId: string;
  ownerId: string;
  ownerName: string;
  permission: 'view' | 'edit';
  groupId: string;
  updatedAt: string;
}
export interface SharingSession {
  userId: string;
  available: boolean;
  shares: readonly CalendarShare[];
}
export interface SharingWriteOptions {
  /** Target grant version the owner explicitly confirmed before moving data. */
  confirmExposure?: Record<string, string>;
  versions?: SharingVersions;
}
export type SharingVersions = Partial<Record<'events'|'todos'|'event_exceptions', Record<string,string>>>;
export function sharingVersionsOf(data:DayPopUserData):SharingVersions {
  return {events:Object.fromEntries(data.events.map(e=>[e.id,e.updatedAt])),todos:Object.fromEntries(data.todos.map(t=>[t.id,t.updatedAt])),
    event_exceptions:Object.fromEntries(data.eventExceptions.map(x=>[x.id,x.updatedAt]))};
}
export interface CalendarSharingRepository {
  personalData(): DayPopUserData;
  sharingSession(): SharingSession;
  clearReceived(): DayPopUserData;
  setCalendarShare(id: string, permission: 'view' | 'edit' | null): Promise<DayPopUserData>;
  setTodoSharingScope(id: string, scope: SharingScope): Promise<DayPopUserData>;
  captureSharingVersions(): SharingVersions;
  withSharingVersions(versions: SharingVersions, operation: () => Promise<DayPopUserData>): Promise<DayPopUserData>;
}
export function canShareCalendars(repository: DayPopRepository): repository is DayPopRepository & CalendarSharingRepository {
  const candidate=repository as Partial<CalendarSharingRepository>;
  return typeof candidate.personalData==='function' && typeof candidate.sharingSession==='function'
    && typeof candidate.setCalendarShare==='function' && typeof candidate.setTodoSharingScope==='function'
    && typeof candidate.clearReceived==='function' && typeof candidate.captureSharingVersions==='function'
    && typeof candidate.withSharingVersions==='function';
}
export function receivedCalendar(session: SharingSession | undefined, id: string): CalendarShare | undefined {
  return session?.shares.find(s=>s.calendarId===id && s.ownerId!==session.userId);
}
export function calendarPermission(session: SharingSession | undefined,id: string): 'owner' | 'view' | 'edit' {
  return receivedCalendar(session,id)?.permission ?? 'owner';
}
export function canEditSharedEvent(data: DayPopUserData,session: SharingSession | undefined,id: string): boolean {
  if(!data.events.some(e=>e.id===id)) return false;
  const ids=new Set([id]);let previous=0;
  while(previous!==ids.size) {
    previous=ids.size;
    for(const x of data.eventExceptions) if(x.replacementEventId && (ids.has(x.eventId)||ids.has(x.replacementEventId))) {
      ids.add(x.eventId);ids.add(x.replacementEventId);
    }
  }
  return data.events.filter(e=>ids.has(e.id)).every(e=>calendarPermission(session,e.calendarId)!=='view');
}
export function hasMixedEventPrivacy(data:DayPopUserData,id:string):boolean {
  const ids=new Set([id]);let previous=0;
  while(previous!==ids.size) {
    previous=ids.size;
    for(const x of data.eventExceptions)if(x.replacementEventId && (ids.has(x.eventId)||ids.has(x.replacementEventId))) {
      ids.add(x.eventId);ids.add(x.replacementEventId);
    }
  }
  return new Set(data.events.filter(e=>ids.has(e.id)).map(e=>e.sharingScope)).size>1;
}
export function parseSharingManifest(value: unknown): CalendarShare[] {
  if(!Array.isArray(value)) throw new Error('分享權限資料格式不正確。');
  const seen=new Set<string>();
  return value.map(entry=>{
    if(!entry || typeof entry!=='object' || !('calendarId' in entry)) throw new Error('分享權限資料格式不正確。');
    const row=entry as Record<string,unknown>;
    const calendarId=parseDomainId(row.calendarId,'calendarId');
    if(seen.has(calendarId) || !['view','edit'].includes(String(row.permission))
      || typeof row.ownerName!=='string' || row.ownerName.length>300
      || typeof row.updatedAt!=='string' || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error('分享權限資料格式不正確。');
    seen.add(calendarId);
    return {calendarId,ownerId:parseDomainId(row.ownerId,'ownerId'),groupId:parseDomainId(row.groupId,'groupId'),
      ownerName:row.ownerName,permission:row.permission as 'view'|'edit',updatedAt:row.updatedAt};
  });
}

/** Produce the only document eligible for cache, JSON and ICS backup. */
export function personalProjection(data: DayPopUserData, received: ReadonlySet<string>): DayPopUserData {
  const events=data.events.filter(e=>!received.has(e.calendarId));
  const eventIds=new Set(events.map(e=>e.id));
  return {...data,calendars:data.calendars.filter(c=>!received.has(c.id)),events,
    eventAttachments:data.eventAttachments.filter(a=>eventIds.has(a.eventId)),
    eventExceptions:data.eventExceptions.filter(x=>eventIds.has(x.eventId)),
    todos:data.todos.filter(t=>!received.has(t.calendarId)),stickers:data.stickers.filter(s=>!received.has(s.calendarId))};
}
