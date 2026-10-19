import { useContext,useEffect,useRef } from 'react';
import { DataContext } from './dataContext';

export interface RetainedSharingDraft { key:string;label:string;value:string }

/** An RLS revalidation may remove the row that owns an inline editor. Preserve
 * only its dirty input in this account's mounted boundary, never in storage. */
export function useRetainedSharingDraft(key:string,label:string,value:string,dirty:boolean,enabled:boolean) {
  const context=useContext(DataContext);
  const keep=context?.keepSharingDraft;const forget=context?.discardSharingDraft;
  const pending=useRef<RetainedSharingDraft|null>(null);
  useEffect(()=>{
    if(dirty && enabled)pending.current={key,label,value};
    else if(!dirty)pending.current=null;
    // A grant disappearing must not erase the last already captured input.
  },[dirty,enabled,key,label,value]);
  useEffect(()=>()=>{if(pending.current)keep?.(pending.current);},[keep]);
  return {discard(){pending.current=null;forget?.(key);}};
}
